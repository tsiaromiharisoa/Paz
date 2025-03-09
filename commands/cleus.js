const axios = require('axios');
const sendMessage = require('../handles/sendMessage');

// Structure de réponse: author, cleus

module.exports = async (senderId, prompt) => {
    try {
        // Vérifier si l'utilisateur a fourni un texte
        if (!prompt || prompt.trim() === '') {
            await sendMessage(senderId, "Veuillez fournir un texte après la commande. Par exemple: cleus votre_texte");
            return;
        }

        // Envoyer un message d'attente
        await sendMessage(senderId, "🔄 Traitement de votre demande en cours...");

        // Construire l'URL avec les paramètres
        let apiUrl = 'http://sgp1.hmvhostings.com:25743/cleus?message=bonjour';

        // Remplacer les paramètres dans l'URL par la valeur fournie par l'utilisateur
        apiUrl = apiUrl.replace('message=bonjour', 'message=' + encodeURIComponent(prompt.trim()));

        // Appel à l'API
        const response = await axios.get(apiUrl);
        const data = response.data;

        // Formater la réponse en fonction de la structure
        let formattedResponse = '';

        if (typeof data === 'string') {
            formattedResponse = data;
        } else if (typeof data === 'object') {
            // Extraire les informations pertinentes
            formattedResponse = `📊 • 𝗥𝗲́𝘀𝘂𝗹𝘁𝗮𝘁𝘀
━━━━━━━━━━━━━━
`;
            if (data.author) formattedResponse += `author: ${data.author}
`;
            if (data.cleus) formattedResponse += `cleus: ${data.cleus}
`;
            formattedResponse += `━━━━━━━━━━━━━━`;
        }

        await sendMessage(senderId, formattedResponse);
    } catch (error) {
        console.error('Erreur lors de la requête à l\'API:', error);
        await sendMessage(senderId, "Désolé, une erreur s'est produite lors de la communication avec l'API. Veuillez réessayer plus tard.");
    }
};

// Ajouter les informations de la commande
module.exports.info = {
    name: "cleus",  // Le nom de la commande
    description: "Interagit avec l'API cleus",  // Description de la commande
    usage: "Envoyez 'cleus votre_texte' pour obtenir une réponse"  // Comment utiliser la commande
};