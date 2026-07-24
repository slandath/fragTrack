import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TRPCProvider } from "./trpc";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Settings from "./pages/Settings";

function App() {
  return (
    <TRPCProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </TRPCProvider>
  );
}

export default App;
