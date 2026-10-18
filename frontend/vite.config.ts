import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveApiBase } from './src/api/deploymentConfig.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), { name: 'validate-deployment-api', configResolved(config) { resolveApiBase(config.env.VITE_API_URL, config.isProduction) } }],
})
