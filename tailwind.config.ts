import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B211F", deep: "#0E3A37", deep2: "#0A2C2A",
        paper: "#FBF8F1", paper2: "#F3EEE2", line: "#E4DDCD",
        muted: "#5C6B67", gold: "#B8791F", goldSoft: "#E7C877",
        paid: "#1E9E6A", late: "#D0453F",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', "system-ui", "sans-serif"],
        display: ['"Readex Pro"', '"IBM Plex Sans Arabic"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
