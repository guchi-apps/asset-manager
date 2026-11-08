import SwiftUI
import WidgetKit

/// ロック画面ウィジェット「明細入力」（#1205）。データは持たず、タップで家計簿の「手入力で追加」を開くだけ。
/// タップ先のURLは、アプリ側 `AppConfig.swift` の `ledgerAddHost`（スキーム `assetmanager`）と揃えること
/// （`ios/scripts/check-consistency.mjs` が照合する）。
struct LedgerAddEntry: TimelineEntry {
    let date: Date
}

struct LedgerAddProvider: TimelineProvider {
    func placeholder(in context: Context) -> LedgerAddEntry { LedgerAddEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (LedgerAddEntry) -> Void) {
        completion(LedgerAddEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LedgerAddEntry>) -> Void) {
        // 表示が変わらないので、更新は要らない
        completion(Timeline(entries: [LedgerAddEntry(date: .now)], policy: .never))
    }
}

struct LedgerAddWidgetView: View {
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: "square.and.pencil")
                .font(.system(size: 24, weight: .semibold))
        }
        .widgetURL(URL(string: "assetmanager://ledger-add"))
        .containerBackground(.clear, for: .widget)
        .accessibilityLabel("明細入力")
    }
}

struct LedgerAddWidget: Widget {
    let kind = "LedgerAddWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LedgerAddProvider()) { _ in
            LedgerAddWidgetView()
        }
        .configurationDisplayName("明細入力")
        .description("ロック画面から、家計簿の取引追加を開きます。")
        .supportedFamilies([.accessoryCircular])
    }
}

@main
struct AssetManagerWidgetBundle: WidgetBundle {
    var body: some Widget {
        LedgerAddWidget()
    }
}
