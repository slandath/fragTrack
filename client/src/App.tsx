import { BrowserRouter, Routes, Route } from "react-router-dom";
import { TRPCProvider } from "./trpc";
import Home from "./pages/Home";
import Login from "./pages/Login";

function App() {
  return (
    <TRPCProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
        </Routes>
      </BrowserRouter>
    </TRPCProvider>
  );
}

export default App;
