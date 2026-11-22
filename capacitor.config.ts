import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "es.obralocal.app",
  appName: "Gestor Autónomo",
  webDir: "dist",
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
  },
};

export default config;
