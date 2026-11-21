<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useNewInvoice } from './composables/useNewInvoice';
import { logout, session } from './session';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const newInvoice = useNewInvoice();

const tabs = [
  { name: 'home', label: 'nav.home' },
  { name: 'invoices', label: 'nav.invoices' },
  { name: 'customers', label: 'nav.customers' },
  { name: 'catalog', label: 'nav.catalog' },
  { name: 'more', label: 'nav.more' },
] as const;

/** Navigation only for fully logged-in users (not during the forced password change). */
const showNav = computed(() => session.user !== null && !session.user.mustChangePassword);

async function signOut(): Promise<void> {
  await logout().catch(() => {});
  await router.replace({ name: 'login' });
}
</script>

<template>
  <div class="shell" :class="{ 'shell--nav': showNav }">
    <header v-if="session.user" class="topbar">
      <span class="topbar__brand">{{ t('app.name') }}</span>
      <button type="button" class="link-button topbar__logout" @click="signOut">
        {{ t('nav.logout') }}
      </button>
    </header>

    <RouterView />

    <!-- FR-INV-22: "New invoice" one tap away on main screens without their own button. -->
    <button
      v-if="showNav && route.meta.fab"
      type="button"
      class="fab"
      :disabled="newInvoice.creating.value"
      @click="newInvoice.create()"
    >
      {{ t('invoices.new') }}
    </button>

    <nav v-if="showNav" class="tabbar" :aria-label="t('nav.main')">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.name"
        :to="{ name: tab.name }"
        class="tabbar__item"
        :class="{ 'tabbar__item--active': route.meta.tab === tab.name }"
        :aria-current="route.meta.tab === tab.name ? 'page' : undefined"
      >
        {{ t(tab.label) }}
      </RouterLink>
    </nav>
  </div>
</template>
