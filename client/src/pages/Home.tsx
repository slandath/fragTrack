import { authClient } from "../auth";
import { trpc } from "@/trpc";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

export default function Home() {
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [url, setUrl] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const addFragrance = trpc.addFragrance.useMutation();
  const addRetailerUrl = trpc.addRetailerUrl.useMutation();
  const lookupPrice = trpc.lookupPrice.useMutation();

  async function runTest() {
    setLoading(true);
    setLog([]);
    try {
      const frag = await addFragrance.mutateAsync({ name, brand });
      setLog((p) => [...p, `✓ Created: ${frag.brand} - ${frag.name}`]);

      const retailerUrl = await addRetailerUrl.mutateAsync({ fragranceId: frag.id, url });
      setLog((p) => [...p, `✓ URL added: ${retailerUrl.url}`]);

      const price = await lookupPrice.mutateAsync({ retailerUrlId: retailerUrl.id });
      if (price.amount) {
        setLog((p) => [...p, `✓ Price: ${price.currency ?? ""} ${price.amount}`]);
      } else {
        setLog((p) => [...p, `⚠ No price found (site may not have JSON-LD)`]);
      }
    } catch (e) {
      setLog((p) => [...p, `✗ Error: ${(e as Error).message}`]);
    } finally {
      setLoading(false);
    }
  }

  if (isPending) return <div>Loading...</div>;
  if (!session) {
    navigate("/login");
    return null;
  }
  return (
    <div>
      <h1>Home Page</h1>
      {session.user && <p>Logged in as {session.user.name}</p>}
      <hr />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Fragrance Name" />
      <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" />
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL" />
      <button onClick={runTest} disabled={loading}>
        {loading ? "Running..." : "Test Pipeline"}
      </button>
      <div>
        {log.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}
