// Nexus PayLinks SaaS - Configuration
export default {
  server: {
    port: process.env.NEXUS_PORT ? parseInt(process.env.NEXUS_PORT) : 4000,
  },
  security: {
    hardened: true,
    shieldLite: true,
    csp: {
      additionalScriptSrc: [],
      additionalConnectSrc: [],
    },
  },
};
