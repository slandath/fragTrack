import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TRPCProvider } from "./trpc";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import RequireAuth from "./components/RequireAuth";

function App() {
  return (
    <TRPCProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route path="/login" element={<Login />} />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </TRPCProvider>
  );
}

export default App;
