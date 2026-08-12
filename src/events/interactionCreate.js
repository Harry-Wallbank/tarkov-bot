module.exports = {
  name: 'interactionCreate',
  async execute(interaction, client) {
    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return;
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Error in /${interaction.commandName} autocomplete:`, error);
        await interaction.respond([]).catch(() => {});
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      for (const command of client.commands.values()) {
        if (typeof command.modalSubmit !== 'function' || !interaction.customId.startsWith(`${command.data.name}_`)) continue;
        try {
          await command.modalSubmit(interaction);
        } catch (error) {
          console.error(`Error in /${command.data.name} modal submit:`, error);
          const payload = { content: 'Something went wrong processing that.', ephemeral: true };
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => {});
          } else {
            await interaction.reply(payload).catch(() => {});
          }
        }
        return;
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Error executing /${interaction.commandName}:`, error);
      const payload = {
        content: 'Something went wrong running that command.',
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  },
};
