import { Fraunces, Inter, Heebo, Frank_Ruhl_Libre } from 'next/font/google';
import './globals.css';
const serif = Fraunces({ subsets: ['latin'], variable: '--serif', axes: ['opsz'], display: 'swap' });
const hserif = Frank_Ruhl_Libre({ subsets: ['hebrew', 'latin'], variable: '--hserif', weight: ['400', '500', '700'], display: 'swap' });
const sans = Inter({ subsets: ['latin'], variable: '--sans', display: 'swap' });
const hsans = Heebo({ subsets: ['hebrew', 'latin'], variable: '--hsans', display: 'swap' });
export const metadata = { title: 'Viaggio — Trip Planner', description: 'Plan, map and carry your itinerary offline.' };
export const viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f7f1e8' }, { media: '(prefers-color-scheme: dark)', color: '#16100d' }],
};
export default function Root({ children }) {
  return <html lang="en" suppressHydrationWarning className={`${serif.variable} ${hserif.variable} ${sans.variable} ${hsans.variable}`}><body>{children}</body></html>;
}
