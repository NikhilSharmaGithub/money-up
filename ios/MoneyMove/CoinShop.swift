// The paid side of the store: coin packs sold through StoreKit 2.
//
// Nothing here ever mints a coin. The signed transaction goes to
// /api/store/redeem, the server checks it against Apple's certificate chain,
// and the balance is then re-read from the wallet endpoint — so a jailbroken
// receipt buys exactly nothing.

import Foundation
import Combine
import StoreKit

@MainActor
final class CoinShop: ObservableObject {
    /// One shop for the whole process: the Transaction.updates listener has to
    /// outlive whichever screen happens to be on top when Apple finishes a
    /// purchase that was interrupted or made on another device.
    static let shared = CoinShop()

    /// The catalogue as the server describes it — names, coin counts, bonuses.
    @Published private(set) var packs: [CoinPack] = CoinShop.builtIn
    /// productId -> the StoreKit product that is actually on sale.
    @Published private(set) var products: [String: Product] = [:]
    /// The pack being bought right now, so its card can show a spinner.
    @Published private(set) var buying: String?
    /// The App Store has answered, successfully, at least once.
    @Published private(set) var checked = false
    /// The last App Store lookup failed or came back empty — the shop offers a
    /// Try again instead of rows that cannot be tapped.
    @Published private(set) var failed = false
    /// A lookup is in the air right now.
    @Published private(set) var loading = false

    /// Are the packs purchasable right now?
    var onSale: Bool { !products.isEmpty }

    private var watcher: Task<Void, Never>?

    /// The three packs, as the app itself knows them.
    ///
    /// The server's catalogue adds names and bonuses, but it is not allowed to
    /// decide whether the coin packs exist. Build 8 hid the whole "Get coins"
    /// section whenever the server was slow to answer — and a free server that
    /// has gone to sleep is slow to answer — which to an App Store reviewer is
    /// an app that refers to a Store with nothing in it.
    static let builtIn: [CoinPack] = [
        CoinPack(id: "coins.small", productId: "com.moneymove.game.coins.small", coins: 500,
                 price: "4.99", emoji: "🪙", name: "Pocket change", bonus: 0),
        CoinPack(id: "coins.mid", productId: "com.moneymove.game.coins.mid", coins: 1100,
                 price: "9.99", emoji: "💰", name: "Deep pockets", bonus: 10),
        CoinPack(id: "coins.large", productId: "com.moneymove.game.coins.large", coins: 2500,
                 price: "19.99", emoji: "🏦", name: "Tycoon chest", bonus: 25),
    ]

    // MARK: - catalogue

    func load(_ store: GameStore) async {
        // The App Store first, asked with the ids the app already knows. The
        // purchase path never waits on our own server — which, on a free plan,
        // can take most of a minute to wake up.
        if products.isEmpty, !loading {
            loading = true
            do {
                let found = try await Product.products(for: Self.builtIn.map(\.productId))
                products = Dictionary(found.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
                failed = found.isEmpty
                checked = !found.isEmpty
            } catch {
                failed = true
            }
            loading = false
        }
        // Then the server's copy — names and bonuses — whenever it answers.
        struct Catalog: Decodable { var packs: [CoinPack]? }
        let catalog: Catalog? = try? await store.fetchJSON("/api/store")
        if let served = catalog?.packs, !served.isEmpty { packs = served }
    }

    /// What to print on the card. Only ever Apple's own localised price — a
    /// hard-coded dollar figure is wrong in every other country and, on a row
    /// that cannot be tapped, reads as a broken shop.
    func priceLabel(for pack: CoinPack) -> String? {
        products[pack.productId]?.displayPrice
    }

    // MARK: - buying

    func buy(_ pack: CoinPack, with store: GameStore) async {
        guard let product = products[pack.productId], buying == nil else { return }
        buying = pack.id
        defer { buying = nil }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                await redeem(verification, with: store)
            case .userCancelled:
                break
            case .pending:
                // Ask-to-buy and friends: it lands later through the listener.
                store.showToast("Waiting on approval for that purchase.")
            @unknown default:
                break
            }
        } catch {
            store.showToast("That purchase didn't go through.", isError: true)
        }
    }

    /// Purchases that complete outside this screen — approved later, restored,
    /// or made on another device — arrive here.
    func watchTransactions(_ store: GameStore) {
        guard watcher == nil else { return }
        watcher = Task { [weak self] in
            for await update in StoreKit.Transaction.updates {
                await self?.redeem(update, with: store)
            }
        }
    }

    private func redeem(_ result: VerificationResult<StoreKit.Transaction>, with store: GameStore) async {
        // Apple's own check is only the first gate — the server re-verifies the
        // signature before a single coin moves.
        guard case .verified(let transaction) = result else {
            store.showToast("That purchase couldn't be verified.", isError: true)
            return
        }
        struct Reply: Decodable { var ok: Bool?; var error: String?; var coins: Int? }
        let reply: Reply? = try? await store.fetchJSON(
            "/api/store/redeem", method: "POST",
            body: ["token": store.token, "signedTransaction": result.jwsRepresentation]
        )
        guard reply?.ok == true else {
            // Deliberately left unfinished: StoreKit hands it back through
            // Transaction.updates, so the coins land on the next try.
            store.showToast(reply?.error ?? "Couldn't reach the coin vault — we'll retry.", isError: true)
            return
        }
        await transaction.finish()
        SoundKit.shared.buy()
        store.refreshWallet()
        store.showToast("Coins added — go spend them.", glyph: .coin)
    }
}
