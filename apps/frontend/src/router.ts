import { createRouter, createWebHashHistory, type Router } from 'vue-router';
import { ensureSessionLoaded, session } from './session';

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without login. */
    public?: boolean;
    /** Requires the ADMIN role (FR-AUTH-02). */
    admin?: boolean;
    /** Bottom-bar tab that is highlighted for this screen. */
    tab?: 'home' | 'invoices' | 'customers' | 'catalog' | 'more';
    /** Show the floating "New invoice" button (FR-INV-22). */
    fab?: boolean;
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
      {
        path: '/',
        name: 'home',
        component: () => import('./views/HomeView.vue'),
        meta: { tab: 'home' },
      },
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
      // ----- invoices (FR-INV-*) -----
      {
        path: '/invoices',
        name: 'invoices',
        component: () => import('./views/InvoicesView.vue'),
        meta: { tab: 'invoices' },
      },
      {
        path: '/invoices/:id(\\d+)',
        name: 'invoice-edit',
        component: () => import('./views/InvoiceEditorView.vue'),
        props: (route) => ({ id: Number(route.params.id) }),
        meta: { tab: 'invoices' },
      },
      // ----- customers (FR-CUST-*) -----
      {
        path: '/customers',
        name: 'customers',
        component: () => import('./views/CustomersView.vue'),
        meta: { tab: 'customers', fab: true },
      },
      {
        path: '/customers/new',
        name: 'customer-new',
        component: () => import('./views/CustomerFormView.vue'),
        meta: { tab: 'customers' },
      },
      {
        path: '/customers/:id(\\d+)',
        name: 'customer-edit',
        component: () => import('./views/CustomerFormView.vue'),
        props: (route) => ({ id: Number(route.params.id) }),
        meta: { tab: 'customers' },
      },
      // ----- catalogue (FR-CAT-*) -----
      {
        path: '/catalog',
        name: 'catalog',
        component: () => import('./views/CatalogView.vue'),
        meta: { tab: 'catalog', fab: true },
      },
      {
        path: '/catalog/new',
        name: 'catalog-new',
        component: () => import('./views/CatalogItemFormView.vue'),
        meta: { tab: 'catalog' },
      },
      {
        path: '/catalog/:id(\\d+)',
        name: 'catalog-edit',
        component: () => import('./views/CatalogItemFormView.vue'),
        props: (route) => ({ id: Number(route.params.id) }),
        meta: { tab: 'catalog' },
      },
      // ----- more -----
      {
        path: '/more',
        name: 'more',
        component: () => import('./views/MoreView.vue'),
        meta: { tab: 'more', fab: true },
      },
      {
        path: '/profile',
        name: 'profile',
        component: () => import('./views/ProfileView.vue'),
        meta: { tab: 'more' },
      },
      {
        path: '/company',
        name: 'company',
        component: () => import('./views/CompanyView.vue'),
        meta: { tab: 'more' },
      },
      {
        path: '/settings',
        name: 'settings',
        component: () => import('./views/SettingsView.vue'),
        meta: { admin: true, tab: 'more' },
      },
      {
        path: '/settings/users',
        name: 'users',
        component: () => import('./views/UsersView.vue'),
        meta: { admin: true, tab: 'more' },
      },
      {
        path: '/settings/users/new',
        name: 'user-new',
        component: () => import('./views/UserFormView.vue'),
        meta: { admin: true, tab: 'more' },
      },
      {
        path: '/settings/users/:id(\\d+)',
        name: 'user-edit',
        component: () => import('./views/UserFormView.vue'),
        props: (route) => ({ id: Number(route.params.id) }),
        meta: { admin: true, tab: 'more' },
      },
      {
        path: '/settings/style',
        name: 'style',
        component: () => import('./views/StyleView.vue'),
        meta: { admin: true, tab: 'more' },
      },
      {
        path: '/settings/numbering',
        name: 'numbering',
        component: () => import('./views/NumberingView.vue'),
        meta: { admin: true, tab: 'more' },
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
