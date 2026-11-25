import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{
      source: "/arduino/rehab_usb_protocol.ino",
      destination: "/arduino/RehabConnect_Tracker/RehabConnect_Tracker.ino",
      permanent: false,
    }];
  },
};

export default nextConfig;
