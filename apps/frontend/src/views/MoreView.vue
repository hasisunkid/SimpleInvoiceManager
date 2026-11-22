<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api, type Health } from '../api';
import AppVersion from '../components/AppVersion.vue';
import { logout, session } from '../session';

/** Secondary navigation: keeps the bottom bar at four tabs on small phones (NFR-UX-01). */
const { t } = useI18n();
const router = useRouter();
const isAdmin = computed(() => session.user?.role === 'ADMIN');
const health = ref<Health | null>(null);

onMounted(async () => {
  try {
    health.value = await api.get<Health>('health');
  } catch {
    // Version stays hidden while the server is unreachable.
  }
});

async function signOut(): Promise<void> {
  await logout().catch(() => {});
  await router.replace({ name: 'login' });
}
</script>

<template>
  <main class="page">
    <h1>{{ t('more.title') }}</h1>
    <ul class="list">
      <li>
        <RouterLink :to="{ name: 'company' }" class="list__item">
          <span class="list__title">{{ t('company.title') }}</span>
          <span class="list__sub">{{ t('company.hint') }}</span>
        </RouterLink>
      </li>
      <li v-if="isAdmin">
        <RouterLink :to="{ name: 'settings' }" class="list__item">
          <span class="list__title">{{ t('settings.title') }}</span>
          <span class="list__sub">
            {{ [t('settings.users'), t('settings.style'), t('settings.numbering')].join(' · ') }}
          </span>
        </RouterLink>
      </li>
      <li>
        <RouterLink :to="{ name: 'profile' }" class="list__item">
          <span class="list__title">{{ t('profile.title') }}</span>
          <span class="list__sub">{{ session.user?.displayName }}</span>
        </RouterLink>
      </li>
    </ul>
    <button type="button" class="secondary" @click="signOut">{{ t('nav.logout') }}</button>
    <AppVersion
      v-if="health"
      :version="health.version"
      :release-notes-url="health.releaseNotesUrl"
    />
  </main>
</template>
