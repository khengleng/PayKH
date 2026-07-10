export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold">PayKH Checkout</h1>
        <p className="mt-2 text-slate-600">
          This is the hosted checkout service. Open a specific payment at{' '}
          <code className="rounded bg-slate-200 px-1">/pay/&lt;payment_id&gt;</code>.
        </p>
      </div>
    </main>
  );
}
