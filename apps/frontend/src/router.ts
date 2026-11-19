import { createRouter, createWebHashHistory } from 'vue-router';
import LoginView from './views/LoginView.vue';

/**
 * Hash history keeps the document URL fixed at the (unknown, per-installation) ingress base
 * path, so no server-side SPA fallback or base-path rewriting is needed (AR-13, ADR 0003).
 */
export function createAppRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', redirect: '/login' },
      { path: '/login', name: 'login', component: LoginView },
    ],
  });
}
