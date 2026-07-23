import { authClient } from "../auth";

export default function Login() {
  return (
    <div>
      <h1>Login</h1>
      <button onClick={() => authClient.signIn.social({ provider: "github" })}>
        Sign in with GitHub
      </button>
    </div>
  );
}
