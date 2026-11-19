<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { logout, session } from './session';

const { t } = useI18n();
const router = useRouter();

/** Navigation only for fully logged-in users (not during the forced password change). */
const showNav = computed(() => session.user !== null && !session.user.mustChangePassword);
const isAdmin = computed(() => session.user?.role === 'ADMIN');

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

    <nav v-if="showNav" class="tabbar" :aria-label="t('nav.main')">
      <RouterLink :to="{ name: 'home' }" class="tabbar__item">{{ t('nav.home') }}</RouterLink>
      <RouterLink :to="{ name: 'company' }" class="tabbar__item">
        {{ t('nav.company') }}
      </RouterLink>
      <RouterLink v-if="isAdmin" :to="{ name: 'settings' }" class="tabbar__item">
        {{ t('nav.settings') }}
      </RouterLink>
      <RouterLink :to="{ name: 'profile' }" class="tabbar__item">
        {{ t('nav.profile') }}
      </RouterLink>
    </nav>
  </div>
</template>
