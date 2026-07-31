import { createApp } from "vue";
import { createPinia } from "pinia";
import "./assets/tokens.css";
import "@delebash/llm-ui/common/styles.css";
import "./assets/app.css";
import App from "./App.vue";

createApp(App).use(createPinia()).mount("#app");
