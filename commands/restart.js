const sendMessage = require('../handles/sendMessage');
const { exec } = require('child_process');

module.exports = async (senderId, args) => {
    try {
        // Envoyer un message de confirmation
        await sendMessage(senderId, "🔄 Redémarrage du bot en cours...");
        console.log(`Redémarrage demandé par l'utilisateur: ${senderId}`);

        // Redémarrer le processus Node.js
        setTimeout(() => {
            // Utiliser une commande plus sûre pour le redémarrage
            exec('pkill -f "node.*index.js" || true && npm start', (error, stdout, stderr) => {
                if (error) {
                    console.error(`Erreur lors du redémarrage: ${error.message}`);
                    return;
                }
                if (stderr) {
                    console.error(`Stderr: ${stderr}`);
                    return;
                }
                console.log(`Stdout: ${stdout}`);
            });
        }, 2000); // Délai de 2 secondes pour permettre l'envoi du message avant le redémarrage
    } catch (error) {
        console.error('Erreur lors du redémarrage:', error);
        await sendMessage(senderId, "❌ Une erreur est survenue lors du redémarrage du bot.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "restart",  // Le nom de la commande
    description: "Redémarre le bot.",  // Description de la commande
    usage: "Envoyez 'restart' pour redémarrer le bot."  // Comment utiliser la commande
};