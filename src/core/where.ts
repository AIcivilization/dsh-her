/**
 * Where this page is open, against where dsh runs. A page opened from another
 * device (a VPS's dsh, from a phone or a laptop) cannot use a desktop program:
 * anything installed or started would land on the computer running dsh, not on
 * the device in the user's hands. There she lives in the page.
 *
 * DSH's desktop app is not on http(s), and a browser on the same computer (or
 * through an SSH tunnel to a server) is on a loopback name.
 */
export function isRemotePage(protocol: string, hostname: string): boolean {
  if (protocol !== 'http:' && protocol !== 'https:') return false
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host))
}
