import { useState, useEffect } from "react";

const quotes = [
  { text: "The only limit to your earnings is the number of lives you", highlight: "protect." },
  { text: "Champions don't wait for opportunities — they", highlight: "create them." },
  { text: "Every policy submitted is a family", highlight: "secured." },
  { text: "Your competition isn't other agents — it's who you were", highlight: "yesterday." },
  { text: "Consistency beats talent when talent doesn't", highlight: "show up." },
  { text: "The top of the leaderboard is reserved for those who refuse to", highlight: "quit." },
  { text: "Success in insurance is simple:", highlight: "help more people." },
  { text: "Discipline today,", highlight: "dividends tomorrow." },
];

export default function MotivationalQuote() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * quotes.length));
  const [phase, setPhase] = useState<"visible" | "exiting" | "entering">("visible");

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase("exiting");
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % quotes.length);
        setPhase("entering");
        setTimeout(() => setPhase("visible"), 50);
      }, 400);
    }, 7000);
    return () => clearInterval(interval);
  }, []);

  const quote = quotes[index];

  return (
    <div className="text-center min-h-[3.5rem] flex items-center justify-center">
      <p
        className={`text-lg sm:text-xl font-medium text-white/90 transition-all duration-300 ${
          phase === "exiting"
            ? "opacity-0 -translate-y-3"
            : phase === "entering"
            ? "opacity-0 translate-y-3"
            : "opacity-100 translate-y-0"
        }`}
      >
        {quote.text}{" "}
        <span className="text-gold-gradient font-bold">{quote.highlight}</span>
      </p>
    </div>
  );
}
