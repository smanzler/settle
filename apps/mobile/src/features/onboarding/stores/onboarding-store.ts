import { Storage } from "expo-sqlite/kv-store";
import { create } from "zustand";

const COMPLETED_KEY = "onboarding-completed";

type OnboardingStore = {
  completed: boolean;
  complete: () => void;
  reset: () => void;
};

export const useOnboardingStore = create<OnboardingStore>((set) => ({
  completed: Storage.getItemSync(COMPLETED_KEY) === "true",

  complete() {
    Storage.setItemSync(COMPLETED_KEY, "true");
    set({ completed: true });
  },

  reset() {
    Storage.removeItemSync(COMPLETED_KEY);
    set({ completed: false });
  },
}));
