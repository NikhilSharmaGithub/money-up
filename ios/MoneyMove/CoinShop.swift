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
    @Published private(set) var packs: [CoinPack] = []
    /// productId -> the StoreKit product that is actually on sale.
    @Published private(set) var products: [String: Product] = [:]
    /// The pack being bought right now, so its card can show a spinner.
    @Published private(set) var buying: String?
    /// A products lookup has come back, however empty it was.
    @Published private(set) var checked = false

    /// Are the packs live in App Store Connect yet? Until they are, the section
    /// shows what's coming instead of pretending it can sell anything.
    var onSale: Bool { !products.isEmpty }

    private var watcher: Task<Void, Never>?

    // MARK: - catalogue

    func load(_ store: GameStore) async {
        if packs.isEmpty {
            struct Catalog: Decodable { var packs: [CoinPack]? }
            let catalog: Catalog? = try? await store.fetchJSON("/api/store")
            packs = catalog?.packs ?? []
        }
        guard !packs.isEmpty else { return }
        // One successful lookup is enough — re-asking the App Store every time
        // the tab opens just blocks on the network for the same answer. A
        // lookup that came back empty is still worth retrying.
        guard products.isEmpty else { return }
        let found = (try? await Product.products(for: packs.map(\.productId))) ?? []
        products = Dictionary(found.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        checked = true
    }

    /// What to print on the card: Apple's localised price once the product
    /// exists, the server's plain number until then.
    func priceLabel(for pack: CoinPack) -> String {
        products[pack.productId]?.displayPrice ?? "$\(pack.price)"
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
        store.showToast("🪙 Coins added — go spend them.")
    }
}
