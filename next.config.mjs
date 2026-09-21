// @ts-check
// 設定ファイルは .mjs にする（.ts に戻さない）。next.config.ts だと本番の `next start` が
// 設定ファイルをトランスパイルするためだけに SWC のネイティブバイナリを読み込み、そのまま
// 常駐してメモリとスレッドを消費する（ops-dashboard#291・#304 で実測）。
import path from "path";
import fs from "fs";
import withSerwistInit from "@serwist/next";

// package.json からバージョンを取得
const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '0.0.0';



/** @type {import("next").NextConfig} */
const nextConfig = {
    // LAN 上の別端末（sslip.io 経由）や Cloudflare Tunnel 経由の外出先アクセス時に、
    // 開発サーバーがクロスオリジンリクエストとして弾かないようにするための許可設定
    // （本番ビルドには影響しない）。
    allowedDevOrigins: ['*.sslip.io', '*.minagu.work'],
    env: {
        NEXT_PUBLIC_APP_VERSION: version,
    },
    experimental: {
        serverActions: {
            // レシート画像（最大5MB）をServer Action経由で受け取るため、既定の1MBでは足りない。
            bodySizeLimit: "8mb",
        },
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'lh3.googleusercontent.com',
                port: '',
                pathname: '/**',
            },
        ],
    },
};

const withSerwist = withSerwistInit({
    swSrc: "app/sw.ts",
    swDest: "public/sw.js",
    disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
