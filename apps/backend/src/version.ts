/** Release notes of a version on GitHub (AR-26); tags are `vX.Y.Z` (AR-22). */
const RELEASES_URL = 'https://github.com/hasisunkid/SimpleInvoiceManager/releases/tag/';

const RELEASE_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Link to the GitHub release of `version`, or null for local builds (`dev`) and other labels. */
export function releaseNotesUrl(version: string): string | null {
  return RELEASE_VERSION.test(version) ? `${RELEASES_URL}v${version}` : null;
}
