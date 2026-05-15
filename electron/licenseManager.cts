import { machineIdSync } from 'node-machine-id';
import { createHash } from 'crypto';

export class LicenseManager {

    // Bilgisayara özel, şifrelenmiş donanım kimliğini (HWID) üretir
    static getDeviceHWID(): string {
        try {
            // node-machine-id paketi Windows/Mac/Linux için benzersiz ID'yi otomatik alır
            const rawId = machineIdSync(true); // true = orijinal ID'yi ver

            // Güvenlik için bu ID'yi SHA-256 ile şifreliyoruz
            return createHash('sha256').update(rawId).digest('hex');
        } catch (error) {
            console.error("HWID alınırken hata oluştu:", error);
            return "UNKNOWN_DEVICE";
        }
    }
}