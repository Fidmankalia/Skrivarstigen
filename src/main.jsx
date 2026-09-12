import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

// Kolla efter en ny version varje gång appen öppnas/blir synlig igen, och
// uppdatera direkt utan att fråga - viktigt för en installerad hemskärms-app
// som annars kan visa en gammal "vilande" version istället för att ladda om.
const updateApp = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateApp(true)
  },
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    navigator.serviceWorker?.getRegistration()?.then((registration) => registration?.update())
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
