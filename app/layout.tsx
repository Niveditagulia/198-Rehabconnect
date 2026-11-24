import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'RehabConnect — Your recovery, one step at a time', description: 'Physiotherapy exercise prescriptions, Arduino USB monitoring, and private patient progress records.' };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
