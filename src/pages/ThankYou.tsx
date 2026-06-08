import { Link } from "react-router-dom";
import { CheckCircle, ArrowLeft, Trophy } from "lucide-react";

export default function ThankYou() {
  return (
    <main className="max-w-xl mx-auto px-4 sm:px-6 py-12 sm:py-20 pb-24 lg:pb-20">
      <div className="card-navy-light p-8 sm:p-12 text-center animate-fade-in">
        <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="text-emerald-400" size={32} />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-4">
          Submission Received
        </h1>

        <p className="text-slate-400 leading-relaxed mb-8">
          Thank you for submitting the Business Intake Form.
          Your submission has been received and is being processed. Check the
          leaderboard to see your rankings update!
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/submit"
            className="btn-secondary inline-flex items-center gap-2"
          >
            <ArrowLeft size={18} />
            Submit Another
          </Link>
          <Link
            to="/"
            className="btn-primary inline-flex items-center gap-2"
          >
            <Trophy size={18} />
            View Leaderboard
          </Link>
        </div>
      </div>
    </main>
  );
}
