import { createRouter, createWebHashHistory, type Router } from 'vue-router';
import { ensureSessionLoaded, session } from './session';

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without login. */
    public?: boolean;
    /** Requires the ADMIN role (FR-AUTH-02). */
    admin?: boolean;
  }
}

/**
 * Hash history keeps the document URL fixed at the (unknown, per-installation) ingress base
 * path, so no server-side SPA fallback or base-path rewriting is needed (AR-13, ADR 0003).
 */
export function createAppRouter(): Router {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
      {
        path: '/login',
        name: 'login',
        component: () => import('./views/LoginView.vue'),
        meta: { public: true },
      },
      {
        path: '/change-password',
        name: 'change-password',
        component: () => import('./views/ChangePasswordView.vue'),
      },
      { path: '/profile', name: 'profile', component: () => import('./views/ProfileView.vue') },
      {
        path: '/users',
        name: 'users',
        component: () => import('./views/UsersView.vue'),
        meta: { admin: true },
      },
      {
        path: '/users/new',
        name: 'user-new',
        component: () => import('./views/UserFormView.vue'),
        meta: { admin: true },
      },
      {
        path: '/users/:id(\\d+)',
        name: 'user-edit',
        component: () => import('./views/UserFormView.vue'),
        props: (route) => ({ id: Number(route.params.id) }),
        meta: { admin: true },
      },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  });

  // Mirrors the backend guard so users never see screens they cannot use.
  router.beforeEach(async (to) => {
    await ensureSessionLoaded();
    const user = session.user;
    if (to.meta.public) return user && to.name === 'login' ? { name: 'home' } : true;
    if (!user) {
      return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
    }
    if (user.mustChangePassword) {
      return to.name === 'change-password' ? true : { name: 'change-password' };
    }
    if (to.name === 'change-password') return { name: 'profile' };
    if (to.meta.admin && user.role !== 'ADMIN') return { name: 'home' };
    return true;
  });

  return router;
}
