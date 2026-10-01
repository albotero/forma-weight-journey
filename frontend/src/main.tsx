import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App"
import "./styles/base.css"
import "./styles/layout.css"
import "./styles/dashboard.css"
import "./styles/overlays.css"
import "./styles/auth.css"
import "./styles/dark.css"
import "./styles/responsive.css"
import "./styles/forms.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
