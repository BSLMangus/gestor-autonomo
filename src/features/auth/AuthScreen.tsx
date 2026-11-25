import { Eye, EyeOff, Lock, Mail, ShieldCheck, User, Wrench } from "lucide-react";
import { useState } from "react";
import { ZodError } from "zod";
import type { LocalAccountRecord, SqliteExecutor } from "../../core/contracts/types";
import { AuthRepository } from "../../core/db/repositories/authRepo";

interface AuthScreenProps {
  executor: SqliteExecutor;
  hasExistingAccounts: boolean;
  onAuthenticated: (account: LocalAccountRecord) => Promise<void>;
}

function formatAuthError(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((i) => i.message).join(" · ");
  }
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^(EMAIL_ALREADY_EXISTS|INVALID_CREDENTIALS|AUTH_CRYPTO_UNAVAILABLE):\s*/i, "");
}

export function AuthScreen({
  executor,
  hasExistingAccounts,
  onAuthenticated,
}: AuthScreenProps) {
  const [mode, setMode] = useState<"login" | "register">(
    hasExistingAccounts ? "login" : "register"
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (mode === "register" && password !== confirmPassword) {
      setErrorMsg("Las contraseñas no coinciden.");
      return;
    }

    setBusy(true);
    try {
      const authRepo = new AuthRepository(executor);
      const account =
        mode === "register"
          ? await authRepo.registerAccount({
              display_name: displayName,
              email,
              password,
            })
          : await authRepo.loginAccount({
              email,
              password,
            });
      await onAuthenticated(account);
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="auth-screen"
      className="min-h-dvh w-full cotton-paper text-[#2C2621] flex flex-col justify-center px-4 py-8 overflow-x-hidden"
    >
      <div className="clipboard-panel mx-auto w-full max-w-md rounded-[28px] border border-[#E5DFD2] bg-[#FFFDF7] p-6 space-y-5">
        {/* Cabecera identidad */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EA580C] text-[#FFFDF9] shadow-sm">
            <Wrench className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-sans text-[22px] font-bold tracking-[-0.35px] text-[#2C2621]">
              Gestor Autónomo
            </h1>
            <p className="mt-0.5 text-[13px] text-[#6B6860]">
              Presupuestos, obras y facturas en tu bolsillo
            </p>
          </div>
          <span className="status-emerald inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>100% Local · Tus datos en tu dispositivo</span>
          </span>
        </div>

        {/* Selector Iniciar sesión / Crear cuenta */}
        <div className="grid grid-cols-2 gap-1.5 rounded-full border border-[#E5DFD2] bg-[#F5F1E6] p-1">
          <button
            type="button"
            data-testid="auth-tab-login"
            onClick={() => {
              setMode("login");
              setErrorMsg(null);
            }}
            className={`min-h-[42px] rounded-full text-xs font-semibold transition-colors cursor-pointer ${
              mode === "login"
                ? "bg-[#4B7094] text-[#FFFDF9]"
                : "text-[#6B6860] hover:text-[#2C2621]"
            }`}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            data-testid="auth-tab-register"
            onClick={() => {
              setMode("register");
              setErrorMsg(null);
            }}
            className={`min-h-[42px] rounded-full text-xs font-semibold transition-colors cursor-pointer ${
              mode === "register"
                ? "bg-[#4B7094] text-[#FFFDF9]"
                : "text-[#6B6860] hover:text-[#2C2621]"
            }`}
          >
            Crear cuenta
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            data-testid="auth-error-banner"
            className="rounded-2xl border border-[#DC2626]/30 bg-[#FAD2D8] p-3 text-xs font-medium text-[#5A121C] break-words"
          >
            {errorMsg}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          {mode === "register" && (
            <div>
              <label
                htmlFor="auth-name"
                className="block text-xs font-semibold text-[#6B6860] mb-1"
              >
                Tu nombre o empresa *
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 focus-within:border-[#EA580C]">
                <User className="h-4 w-4 shrink-0 text-[#6B6860]" aria-hidden="true" />
                <input
                  id="auth-name"
                  data-testid="auth-name-input"
                  type="text"
                  autoComplete="name"
                  disabled={busy}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ej: Instalaciones Morales"
                  className="min-h-[46px] w-full min-w-0 bg-transparent text-[14px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label
              htmlFor="auth-email"
              className="block text-xs font-semibold text-[#6B6860] mb-1"
            >
              Correo electrónico *
            </label>
            <div className="flex items-center gap-2 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 focus-within:border-[#EA580C]">
              <Mail className="h-4 w-4 shrink-0 text-[#6B6860]" aria-hidden="true" />
              <input
                id="auth-email"
                data-testid="auth-email-input"
                type="email"
                autoComplete="email"
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.es"
                className="min-h-[46px] w-full min-w-0 bg-transparent text-[14px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="auth-password"
              className="block text-xs font-semibold text-[#6B6860] mb-1"
            >
              Contraseña *
            </label>
            <div className="flex items-center gap-2 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 focus-within:border-[#EA580C]">
              <Lock className="h-4 w-4 shrink-0 text-[#6B6860]" aria-hidden="true" />
              <input
                id="auth-password"
                data-testid="auth-password-input"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="min-h-[46px] w-full min-w-0 bg-transparent text-[14px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:outline-none"
              />
              <button
                type="button"
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                onClick={() => setShowPassword((v) => !v)}
                className="p-1.5 text-[#6B6860] hover:text-[#2C2621] cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {mode === "register" && (
            <div>
              <label
                htmlFor="auth-password-confirm"
                className="block text-xs font-semibold text-[#6B6860] mb-1"
              >
                Repetir contraseña *
              </label>
              <div className="flex items-center gap-2 rounded-2xl border border-[#E5DFD2] bg-[#FFFDF7] px-3.5 focus-within:border-[#EA580C]">
                <Lock className="h-4 w-4 shrink-0 text-[#6B6860]" aria-hidden="true" />
                <input
                  id="auth-password-confirm"
                  data-testid="auth-password-confirm-input"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  disabled={busy}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite tu contraseña"
                  className="min-h-[46px] w-full min-w-0 bg-transparent text-[14px] text-[#2C2621] placeholder:text-[#6B6860]/70 focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            data-testid="auth-submit-btn"
            disabled={busy}
            className="min-h-[50px] w-full rounded-2xl bg-[#D04B00] hover:bg-[#EA580C] text-[14px] font-semibold text-[#FFFDF9] shadow-sm disabled:opacity-50 cursor-pointer transition-colors"
          >
            {busy
              ? "Accediendo..."
              : mode === "register"
                ? "Crear cuenta y configurar"
                : "Iniciar sesión"}
          </button>
        </form>

        <p className="text-center text-[11px] leading-relaxed text-[#6B6860]">
          Tu cuenta y todos tus presupuestos, clientes y facturas se guardan cifrados y en local dentro de este dispositivo.
        </p>
      </div>
    </div>
  );
}
