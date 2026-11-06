import { Fraunces, Inter, Heebo, Frank_Ruhl_Libre } from 'next/font/google';
import './globals.css';
const serif = Fraunces({ subsets: ['latin'], variable: '--serif', axes: ['opsz'] });
const hserif = Frank_Ruhl_Libre({ subsets: ['hebrew'], variable: '--hserif' });
const sans = Inter({ subsets: ['latin'], variable: '--sans' });
const hsans = Heebo({ subsets: ['hebrew'], variable: '--hsans' });
export const metadata = { title: 'Viaggio — Trip Planner', description: 'Plan, map and carry your itinerary offline.' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function Root({ children }) {
  return <html lang="en" className={`${serif.variable} ${hserif.variable} ${sans.variable} ${hsans.variable}`}><body>{children}</body></html>;
}
