import { defaultCache } from "@serwist/next/worker";
import { NetworkOnly, Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: true,
    // 稼働中の版を返す /api/app-version は保存しない（Issue #754）。defaultCache は /api/ を
    // NetworkFirst で保存するため、先に NetworkOnly で拾って古い版の応答を返さないようにする。
    // lib/app-version.ts を import すると package.json ごと sw.js に入るため、パスは直書きする。
    runtimeCaching: [
        {
            matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname === "/api/app-version",
            handler: new NetworkOnly(),
        },
        ...defaultCache,
    ],
});

serwist.addEventListeners();
