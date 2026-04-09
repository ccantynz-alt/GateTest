import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import Problem from "./components/Problem";
import AiNative from "./components/AiNative";
import HowItWorks from "./components/HowItWorks";
import Modules from "./components/Modules";
import Comparison from "./components/Comparison";
import Integrations from "./components/Integrations";
import ContinuousScanning from "./components/ContinuousScanning";
import GateRules from "./components/GateRules";
import Pricing from "./components/Pricing";
import Cta from "./components/Cta";
import Footer from "./components/Footer";

export default function Home() {
  return (
    <>
      {/* Coming Soon Banner */}
      <div className="fixed top-0 left-0 right-0 z-[60] bg-indigo-600 text-white text-center py-2.5 px-4 text-sm font-medium">
        Coming Soon — GateTest is launching shortly
      </div>
      <Navbar />
      <main>
        <Hero />
        <Problem />
        <AiNative />
        <HowItWorks />
        <Modules />
        <Comparison />
        <Integrations />
        <ContinuousScanning />
        <GateRules />
        <Pricing />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
