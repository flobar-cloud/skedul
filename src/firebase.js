import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Ambil nilai ini dari: Firebase Console > Project Settings (ikon gerigi) >
// scroll ke "Your apps" > pilih/buat Web app (</>) > "SDK setup and configuration"
const firebaseConfig = {
  apiKey: "AIzaSyAMknLt1mXkgtZBskGgnQ-cJu3Hfi2ei2Y",
  authDomain: "botskedul.firebaseapp.com",
  projectId: "botskedul",
  storageBucket: "botskedul.firebasestorage.app",
  messagingSenderId: "511614116265",
  appId: "1:511614116265:web:871efd1fe2fd20e5ad64b8",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
