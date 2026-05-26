import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
        // search は未指定 = 任意のクエリ文字列を許可（アバター URL の ?t= キャッシュバスター対応）
      },
    ],
  },
};

export default nextConfig;
