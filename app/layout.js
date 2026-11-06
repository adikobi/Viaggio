import { Fraunces, Inter } from 'next/font/google';
import './globals.css';
const serif = Fraunces({ subsets: ['latin'], variable: '--serif', axes: ['opsz'] });
const sans = Inter({ subsets: ['latin'], variable: '--sans' });
export const metadata = { title: 'Viaggio — Trip Planner', description: 'Plan, map and carry your itinerary offline.' };
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function Root({ children }) {
  return <html lang="en" className={`${serif.variable} ${sans.variable}`}><body>{children}</body></html>;
}
