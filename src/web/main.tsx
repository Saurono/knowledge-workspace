import { createRoot } from "react-dom/client"
import { WebWorkspace } from "./workspace"
import "@/index.css"
import "./styles.css"
import i18n from "@/i18n"
await i18n.changeLanguage("zh")
document.documentElement.classList.add("dark")
createRoot(document.getElementById("root")!).render(<WebWorkspace />)
