import { Bricolage_Grotesque, Heebo } from 'next/font/google';
import './globals.css';
// Two typefaces. Latin (display and UI): Bricolage Grotesque, variable weight + optical size.
// Hebrew (headings and body): Heebo, variable, so every weight is available. Heebo also backs up any Latin glyph.
const lat = Bricolage_Grotesque({ subsets: ['latin'], variable: '--lat', axes: ['opsz'], display: 'swap' });
const hsans = Heebo({ subsets: ['hebrew', 'latin'], variable: '--hsans', display: 'swap' });
export const metadata = {
  title: 'Viaggio — Trip Planner',
  description: 'Plan, map and carry your itinerary offline.',
  appleWebApp: { capable: true, title: 'Viaggio', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};
export const viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ece4d9' }, { media: '(prefers-color-scheme: dark)', color: '#15100c' }],
};
export default function Root({ children }) {
  return <html lang="en" suppressHydrationWarning className={`${lat.variable} ${hsans.variable}`}><body>{children}</body></html>;
}
