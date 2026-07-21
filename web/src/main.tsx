import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(
    <BrowserRouter>
      <App />
    </BrowserRouter>,
  )
}
