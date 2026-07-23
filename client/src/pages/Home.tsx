import { authClient } from "../auth";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const { data: session, isPending } = authClient.useSession();
  const navigate = useNavigate();

  if (isPending) return <div>Loading...</div>;
  if (!session) {
    navigate("/login");
    return null;
  }
  return (
    <div>
      <h1>Home Page</h1>
      {session.user && <p>Logged in as {session.user.name}</p>}
    </div>
  );
}
