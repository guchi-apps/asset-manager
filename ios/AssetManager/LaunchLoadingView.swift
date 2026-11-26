import SwiftUI

/// 起動してWeb版の読み込みが終わるまで、WebViewの上へ重ねる画面（#1659）。
///
/// サーバーの最初の応答が届くまでWebViewは何も描けないため、ここはネイティブで出す。見た目はWeb版の
/// 起動画面（`components/app-startup-fallback.tsx`・`components/app-brand.tsx`）に揃える。
/// アイコンは起動画面（Info.plist の `UILaunchScreen`）と同じく画面の中央に置き、切り替わりで動かさない
struct LaunchLoadingView: View {
    @State private var isSlow = false

    private static let iconSize: CGFloat = 76
    private static let slowAfter: Duration = .seconds(8)

    private var version: String? {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    }

    var body: some View {
        ZStack {
            Color("HeaderBand")
            glow

            Image("LaunchLogo")
                .resizable()
                .frame(width: Self.iconSize, height: Self.iconSize)
                .background(
                    RoundedRectangle(cornerRadius: 29)
                        .fill(Color.accentColor.opacity(0.16))
                        .padding(-10)
                )
                .shadow(color: Color.accentColor.opacity(0.4), radius: 13, y: 10)
                .accessibilityHidden(true)
                // 下の文字はアイコンの位置に影響させない（overlayで下へ垂らす）
                .overlay(alignment: .top) {
                    details
                        .fixedSize()
                        .padding(.top, Self.iconSize + 16)
                }
        }
        .ignoresSafeArea()
        .overlay(alignment: .bottom) {
            if let version {
                Text("v\(version)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.bottom, 12)
            }
        }
        .task {
            // 画面が消えると取り消されるので、そのときは文言を変えない
            guard (try? await Task.sleep(for: Self.slowAfter)) != nil else { return }
            isSlow = true
        }
    }

    private var glow: some View {
        GeometryReader { proxy in
            ZStack {
                EllipticalGradient(
                    colors: [Color.accentColor.opacity(0.26), .clear],
                    center: .center
                )
                .frame(width: proxy.size.width * 1.8, height: proxy.size.height * 0.82)
                .position(x: proxy.size.width / 2, y: -proxy.size.height * 0.1)

                EllipticalGradient(
                    colors: [Color.accentColor.opacity(0.12), .clear],
                    center: .center
                )
                .frame(width: proxy.size.width * 2.4, height: proxy.size.height * 0.87)
                .position(x: proxy.size.width / 2, y: proxy.size.height * 1.2)
            }
        }
        .accessibilityHidden(true)
    }

    private var details: some View {
        VStack(spacing: 6) {
            Text("Asset Manager")
                .font(.title3.weight(.semibold))
            Text("資産の推移と構成を管理する")
                .font(.footnote)
                .foregroundStyle(.secondary)
            SweepBar()
                .padding(.top, 14)
                .padding(.bottom, 8)
            Text(isSlow ? "通信に時間がかかっています" : "起動しています…")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

/// 左から右へ流れ続ける細い進行バー（Web版の `animate-startup-sweep`）。視差効果を減らす設定では止める
private struct SweepBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isSweeping = false

    private let width: CGFloat = 168
    private var barWidth: CGFloat { width * 0.38 }

    var body: some View {
        Capsule()
            .fill(Color.primary.opacity(0.1))
            .frame(width: width, height: 3)
            .overlay(alignment: .leading) {
                Capsule()
                    .fill(Color.accentColor)
                    .frame(width: barWidth)
                    .offset(x: reduceMotion ? 0 : (isSweeping ? barWidth * 2.75 : -barWidth * 1.1))
            }
            .clipShape(Capsule())
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.timingCurve(0.45, 0, 0.25, 1, duration: 1.5).repeatForever(autoreverses: false)) {
                    isSweeping = true
                }
            }
            .accessibilityHidden(true)
    }
}

#Preview("起動中") {
    LaunchLoadingView()
}
