import type { NextConfig } from "next";
import path from "path";
import fs from "fs";
import withSerwistInit from "@serwist/next";

// package.json からバージョンを取得
const packageJsonPath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '0.0.0';



const nextConfig: NextConfig = {
    // LAN 上の別端末（sslip.io 経由）や Cloudflare Tunnel 経由の外出先アクセス時に、
    // 開発サーバーがクロスオリジンリクエストとして弾かないようにするための許可設定
    // （本番ビルドには影響しない）。
    allowedDevOrigins: ['*.sslip.io', '*.minagu.work'],
    env: {
        NEXT_PUBLIC_APP_VERSION: version,
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
