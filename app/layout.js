import { Fraunces, Inter, Heebo } from 'next/font/google';
import './globals.css';
// Latin display: Fraunces. Latin UI: Inter. All Hebrew (headings and body): Heebo, a variable font so every weight is available.
const serif = Fraunces({ subsets: ['latin'], variable: '--serif', axes: ['opsz'], display: 'swap' });
const sans = Inter({ subsets: ['latin'], variable: '--sans', display: 'swap' });
const hsans = Heebo({ subsets: ['hebrew', 'latin'], variable: '--hsans', display: 'swap' });
export const metadata = {
  title: 'Viaggio — Trip Planner',
  description: 'Plan, map and carry your itinerary offline.',
  appleWebApp: { capable: true, title: 'Viaggio', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};
export const viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f4eee4' }, { media: '(prefers-color-scheme: dark)', color: '#17110e' }],
};
export default function Root({ children }) {
  return <html lang="en" suppressHydrationWarning className={`${serif.variable} ${sans.variable} ${hsans.variable}`}><body>{children}</body></html>;
}
