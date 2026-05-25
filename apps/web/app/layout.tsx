export const metadata = {
  title: 'Quant Gate MVP',
  description: 'Gate U本位合约量化交易 MVP',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  )
}
