import { createApp } from 'vue';
import App from './App.vue';
import { setUnauthenticatedHandler } from './api';
import { createAppI18n } from './i18n';
import { createAppRouter } from './router';
import { clearSession } from './session';
import './styles.css';

const i18n = createAppI18n();
document.documentElement.lang = i18n.global.locale.value;

const router = createAppRouter();

// Session ended on the server (expired, logged out elsewhere, deactivated) → back to login.
setUnauthenticatedHandler(() => {
  clearSession();
  if (router.currentRoute.value.name !== 'login') {
    void router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } });
  }
});

createApp(App).use(i18n).use(router).mount('#app');
