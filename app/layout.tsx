import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export async function generateMetadata(): Promise<Metadata> {
  const ROOT_URL = process.env.APP_URL || 'https://celo-swap-agent.vercel.app';
  return {
    title: 'Celo Swap Agent',
    description: 'AI-powered token swaps on Celo',
    other: {
      'fc:miniapp': JSON.stringify({
        version: 'next',
        imageUrl: `${ROOT_URL}/hero.png`,
        button: {
          title: `Launch Agent`,
          action: {
            type: 'launch_miniapp',
            name: 'Celo Swap Agent',
            url: ROOT_URL,
            splashImageUrl: `${ROOT_URL}/splash.png`,
            splashBackgroundColor: '#000000',
          },
        },
      }),
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
