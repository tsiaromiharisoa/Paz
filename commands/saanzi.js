
const axios = require('axios');
const sendMessage = require('../handles/sendMessage');

module.exports = async (senderId, prompt) => {
    try {
        // Vérifier si l'utilisateur a fourni un texte
        if (!prompt || prompt.trim() === '') {
            await sendMessage(senderId, "Veuillez fournir un texte après la commande. Par exemple: saanzi votre_requête");
            return;
        }

        // Envoyer un message d'attente
        await sendMessage(senderId, "🔄 Traitement de votre demande en cours...");

        // Appel à l'API avec encodage URI correct pour éviter les problèmes avec les caractères spéciaux
        const apiUrl = `http://sgp1.hmvhostings.com:25743/saanvi?message=${encodeURIComponent(prompt.trim())}`;
        
        // Appel à l'API sans passer les paramètres deux fois
        const response = await axios.get(apiUrl);

        // Récupérer les données de la réponse
        const data = response.data;
        
        // Extraction des données de la réponse
        let responseText = '';
        
        // Format de réponse détecté: ["author","saanvi"]
        if (data) {
            if (data.author) {
                responseText += `Author: ${data.author}\n`;
            }
            
            if (data.saanvi) {
                responseText += `${data.saanvi}`;
            }
        }

        // Formater la réponse
        let formattedResponse = '';

        if (typeof data === 'string') {
            formattedResponse = data;
        } else if (typeof data === 'object') {
            // Utiliser la réponse formatée si disponible, sinon formater le JSON
            formattedResponse = responseText || JSON.stringify(data, null, 2);
        }

        await sendMessage(senderId, formattedResponse);
    } catch (error) {
        console.error('Erreur lors de la requête à l\'API:', error);
        await sendMessage(senderId, "Désolé, une erreur s'est produite lors de la communication avec l'API. Veuillez réessayer plus tard.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "saanzi",  // Le nom de la commande
    description: "Interaction avec l'API http://sgp1.hmvhostings.com:25743/saanvi",  // Description de la commande
    usage: "Envoyez 'saanzi votre_texte' pour utiliser cette API"  // Comment utiliser la commande
};
