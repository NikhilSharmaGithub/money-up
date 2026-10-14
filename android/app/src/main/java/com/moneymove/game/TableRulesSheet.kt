package com.moneymove.game

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// ── this table's rules ─────────────────────────────────────────────────────

/**
 * One rule as the sheet says it: its mark, its name, how it is set at this
 * table, and what that means at the board, in a sentence. [on] is null for a
 * rule that is a value rather than a switch (the board, the cash); a switch
 * that is off is drawn quieter, so what is in play stands out.
 */
data class TableRuleLine(
    val glyph: String,
    val title: String,
    val value: String,
    val detail: String,
    val on: Boolean? = null,
)

/** A titled group of [TableRuleLine]s, a card each. */
data class TableRuleSection(val title: String, val lines: List<TableRuleLine>)

/**
 * Every rule in play at this table, in plain words, from `state.settings` —
 * the round-2 contract's list (docs/API-1.0.6.md, G4): the board, the money,
 * the rent rules, the clocks, the house's skill, the estates, auction-only,
 * the shuffle, teams, who can find the table, and the prison rule.
 *
 * A switch missing from the push reads exactly what the settings sheet reads
 * for it (LobbySheet.kt), so the two screens can never describe one table two
 * ways. A Play-now or a cup table always plays auction-only and the shuffle
 * at their defaults, whatever the fields say — the server's own rule — so
 * they are shown that way there. What a bankrupt player's streets do is a
 * Play-now table's own rolled rule from 1.0.7, and a cup table's is always
 * the bank ([GameState.estateRule]). Only a table with a house at it says
 * how hard the house plays ([GameState.showsBotSkill]): a table of people
 * has none to describe, a Play-now table's is passing itself off as people,
 * and a cup table has none.
 */
fun tableRuleSections(state: GameState): List<TableRuleSection> {
    val s = state.settings
    val quick = state.quick == true
    val cup = state.cup == true
    val hostSet = !quick && !cup
    fun onOff(on: Boolean) = if (on) "On" else "Off"

    val shuffle = hostSet && s.shuffleBoard == true
    val shuffledNow = state.map.shuffled == true
    val auctionOnly = hostSet && s.auctionOnly == true
    // Auction-only forces auctions on; an older server never sends the one
    // without the other, but a table that says both is read as both.
    val auction = auctionOnly || (s.auction ?: true)
    val estates = state.estateRule
    val teams = s.teams ?: 0
    val clock = s.turnSeconds ?: 90
    val minutes = s.gameMinutes
    val boardName = state.map.name.ifBlank { s.mapId?.replaceFirstChar { it.uppercase() } ?: "Classic" }

    val table = buildList {
        add(TableRuleLine("map", "Board", boardName, if (shuffledNow) "This game's layout is a shuffle of it." else ""))
        add(
            TableRuleLine(
                "shuffle", "Shuffled board", onOff(shuffle || shuffledNow),
                when {
                    shuffledNow -> "The colour sets sit on new squares this game, each with its own prices and rents. Corners, cards, taxes, airports and utilities stay put."
                    shuffle -> "At the start the colour sets trade places, each keeping its prices and rents. Corners, cards, taxes, airports and utilities stay put."
                    else -> "Every street is where the board prints it."
                },
                on = shuffle || shuffledNow,
            ),
        )
        add(TableRuleLine("cash", "Starting cash", money(s.startingCash), "What everybody starts with."))
        add(
            when {
                quick -> TableRuleLine("people", "Table", "Play now", "Matched by Play now, open to strangers.")
                cup -> TableRuleLine("trophy", "Table", "Cup match", "The two players the cup drew. Winner goes through.")
                s.isPrivate ?: true -> TableRuleLine("key", "Table", "Private", "Hidden from the public room list — invite link only.")
                else -> TableRuleLine("globe", "Table", "Public", "Listed in the public room list for anyone to join.")
            },
        )
        add(
            TableRuleLine(
                "people", "Teams", if (teams > 0) "$teams teams" else "Off",
                if (teams > 0) "Teammates never charge each other rent and win together."
                else "Everyone plays for themselves.",
                on = teams > 0,
            ),
        )
        if (state.showsBotSkill) {
            val skill = s.botSkill
            add(TableRuleLine("robot", "Bot skill", skill.label, skill.blurb))
        }
    }

    val time = listOf(
        TableRuleLine(
            "hourglass", "Game length", GameSettings.gameLengthLabel(minutes),
            if (minutes == 0) "Play until one player is left standing."
            else "When the clock runs out, the richest player wins.",
        ),
        TableRuleLine(
            "timer", "Turn clock", if (clock == 0) "Off" else "$clock seconds",
            if (clock == 0) "Nobody is hurried."
            else "Run out of time and the table moves on without you.",
            on = clock > 0,
        ),
    )

    val x2 = s.x2rent ?: false
    val pot = s.vacationCash ?: false
    val noRent = s.noRentInPrison ?: false
    val mortgage = s.mortgage ?: true
    val even = s.evenBuild ?: true
    val rules = listOf(
        TableRuleLine(
            "payment", "Double rent on full sets", onOff(x2),
            if (x2) "Bare streets charge double once one player owns the whole set."
            else "A full set charges its printed rent until it is built on.",
            on = x2,
        ),
        TableRuleLine(
            "vacation", "Vacation cash", onOff(pot),
            if (pot) "Taxes and fees pile up on Vacation, and whoever lands there takes the pot."
            else "Taxes and fees go to the bank.",
            on = pot,
        ),
        TableRuleLine(
            "gavel", "Auctions", onOff(auction),
            if (auction) "A street nobody buys goes under the hammer, and anybody can bid."
            else "A street nobody buys stays with the bank.",
            on = auction,
        ),
        TableRuleLine(
            "gavel", "Auction-only", onOff(auctionOnly),
            if (auctionOnly) "Every unowned street goes straight to auction — nobody buys at the printed price, which is the guide for the bidding."
            else "Land on an unowned street and you may buy it at its price.",
            on = auctionOnly,
        ),
        TableRuleLine(
            "prison", "No rent while in prison", onOff(noRent),
            if (noRent) "Owners collect nothing while they sit in prison."
            else "Owners collect rent even from prison.",
            on = noRent,
        ),
        TableRuleLine(
            "bank", "Mortgages", onOff(mortgage),
            if (mortgage) "Mortgage a street for half its price; buying it back costs 10% more."
            else "Nothing can be mortgaged at this table.",
            on = mortgage,
        ),
        TableRuleLine(
            "crane", "Even building", onOff(even),
            if (even) "Houses go up evenly across a set — no second house on a street before the others have one."
            else "Build on any street of a full set, in any order.",
            on = even,
        ),
        TableRuleLine(
            "skull", "Bankrupt properties", estates.sheet,
            when (estates) {
                EstateRule.RELEASE -> "A bankrupt player's streets go back to the bank, unowned, with their buildings and mortgages cleared."
                EstateRule.AUCTION -> "A bankrupt player's streets are auctioned to everyone, one at a time, buildings sold back and mortgages lifted first."
                EstateRule.CHOOSE -> "The player who goes bankrupt picks: back to the bank, or an auction for everyone. They have 20 seconds — then, or for a player who has left, the house picks whichever keeps the game close."
            },
        ),
        TableRuleLine(
            "police", "Prison", "3 tries",
            "Roll a double to walk out and move. Pay \$50 before rolling to open the door (that ends the turn), or use a get-out card. If the third roll still misses, you walk out free and move by it anyway.",
        ),
    )

    return listOf(
        TableRuleSection("The table", table),
        TableRuleSection("Time", time),
        TableRuleSection("Rules", rules),
    )
}

/**
 * Who set these rules and whether they can still move — the line under the
 * sheet's title.
 */
fun tableRulesSubtitle(state: GameState): String = when {
    state.quick == true -> "Rolled by Play now."
    state.cup == true -> "Set by the cup."
    state.isLobby -> "The host can change these until the game starts."
    else -> "Locked for this game."
}

/**
 * "This table's rules": the "i" beside the sound button. Everything in play
 * here, in words, for whoever is looking — a player mid-game wondering why
 * there was no Buy button, or somebody watching from the rail who never saw
 * the lobby. Read-only and live: the host changing a rule in the lobby
 * changes the line here under the reader's eye.
 *
 * The how-to-play sheet's shape (Welcome.kt): a title row with Done, then the
 * rules in three cards — the table, its clocks, and the rules of play.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TableRulesSheet(store: GameStore, onDismiss: () -> Unit) {
    val state = store.state ?: return onDismiss()
    val p = P.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    MMSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                SfMark("info.circle.fill", 20.dp, p.ink2)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        "This table's rules",
                        modifier = Modifier.semantics { heading() },
                        color = p.ink, fontSize = 19.sp, fontWeight = FontWeight.Black,
                    )
                    Text(
                        tableRulesSubtitle(state),
                        color = quietInk(), fontSize = 12.sp, fontWeight = FontWeight.Medium,
                    )
                }
                Spacer(Modifier.width(10.dp))
                MMButton("Done", kind = BtnKind.GHOST) { onDismiss() }
            }
            for (section in tableRuleSections(state)) {
                Spacer(Modifier.height(18.dp))
                SectionLabel(section.title, modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
                Panel(padding = 14.dp) {
                    section.lines.forEachIndexed { i, line ->
                        if (i > 0) Rule(Modifier.padding(vertical = 11.dp))
                        RuleRow(line)
                    }
                }
            }
        }
    }
}

/** One rule: its mark in a small well, its name and sentence, and how it is set here. */
@Composable
private fun RuleRow(line: TableRuleLine) {
    val p = P.current
    val off = line.on == false
    Row(
        Modifier
            .fillMaxWidth()
            .clearAndSetSemantics {
                contentDescription = buildString {
                    append("${line.title}: ${line.value}.")
                    if (line.detail.isNotBlank()) append(" ${line.detail}")
                }
            },
        // A rule with a sentence under it hangs from the top of its mark; one
        // without (the board's name) sits level with it.
        verticalAlignment = if (line.detail.isBlank()) Alignment.CenterVertically else Alignment.Top,
    ) {
        val well = RoundedCornerShape(9.dp)
        Box(
            Modifier
                .size(30.dp)
                .clip(well)
                .background(p.sunken)
                .border(1.dp, p.rule, well),
            contentAlignment = Alignment.Center,
        ) {
            // The drawn set first; the turn clock's dial is one of the
            // system marks the table bar already draws.
            if (Art.has(line.glyph)) Icon(line.glyph, size = 17.dp, tint = p.ink2, alpha = if (off) 0.55f else 1f)
            else SfMark(line.glyph, 17.dp, if (off) p.ink3 else p.ink2)
        }
        Spacer(Modifier.width(11.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    line.title,
                    modifier = Modifier.weight(1f),
                    color = p.ink, fontSize = 13.5.sp, fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.width(10.dp))
                Text(
                    line.value,
                    modifier = Modifier.widthIn(max = 150.dp),
                    color = if (off) p.ink3 else p.ink,
                    fontSize = 13.sp, fontWeight = FontWeight.ExtraBold,
                    textAlign = TextAlign.End,
                    maxLines = 2,
                )
            }
            if (line.detail.isNotBlank()) {
                Text(
                    line.detail,
                    color = p.ink3, fontSize = 11.5.sp, lineHeight = 15.5.sp, fontWeight = FontWeight.Medium,
                )
            }
        }
    }
}
